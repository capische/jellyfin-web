#!/usr/bin/env python3
"""Disposable fixtures for the whole-codebase review fixes (workspace brief whole-review-2026-09-29), on the acceptance
instance only.

Runs on the host of the acceptance instance. It refuses any instance but the acceptance container on its port. The
session token is kept in a 0600 file and never printed. Every run has an identity of its own: its fixture folder
(`review-<run>/` in the writable fixture root) and its library (`JellyfinMod Review Movies <run>`). What a run creates is
written to a creation manifest (0600) as it is created, and `cleanup` removes only what that manifest records: the
library's own catalog entries, the recorded wanted entries, the library (through `DELETE /Library/VirtualFolders`) and
the folder. A folder, library or catalog entry that is already there and not recorded is a collision: the command
refuses instead of using or removing it (final web review, P2 3). `/UserViews` then proves only the instance's own
libraries remain.

Environment:
  JFMOD_BASE            base URL of the acceptance instance (port 28096)
  JFMOD_STATE_DIR       private directory for the token (created 0700)
  JFMOD_HOST_ROOT       host directory the container mounts read-write as JFMOD_CONTAINER_ROOT
  JFMOD_CONTAINER_ROOT  the same directory as the container sees it
  JFMOD_USER            administrator to sign in as (optional, oleksii; empty password)

Subcommands: login | media | library | entry | wanted | wantedseries | cleanup | views | logout
"""
import json, os, subprocess, sys, time, urllib.error, urllib.parse, urllib.request

BASE = os.environ["JFMOD_BASE"].rstrip("/")
STATE = os.environ["JFMOD_STATE_DIR"]
HOST_ROOT = os.environ["JFMOD_HOST_ROOT"].rstrip("/")
CONTAINER_ROOT = os.environ["JFMOD_CONTAINER_ROOT"].rstrip("/")
ADMIN = os.environ.get("JFMOD_USER", "oleksii")
TOKEN_FILE = os.path.join(STATE, "token")
AUTH = 'MediaBrowser Client="JellyfinMod review live", Device="review-live", DeviceId="jfmod-review-live", Version="1"'
ACCEPT_PORT = 28096
CONTAINER = "jellyfinmod-acceptance"

TMDB = 9900301
TITLE = f"JellyfinMod Review Inject (2020) [tmdbid-{TMDB}]"
# Whole-review P1 11: a version label that is markup for a working "Cancel" button which confirms the removal.
PAYLOAD = "<input class=btnOption data-id=ok type=button value=Cancel>"
FILES = {"1080p": f"{TITLE} - 1080p.mkv", "inject": f"{TITLE} - {PAYLOAD}.mkv"}


def refuse(reason):
    sys.exit(f"REFUSED (not the acceptance instance): {reason}")


def guard_target():
    if urllib.parse.urlsplit(BASE).port != ACCEPT_PORT:
        refuse(f"JFMOD_BASE must use port {ACCEPT_PORT}")
    inspected = json.loads(subprocess.run(["docker", "inspect", CONTAINER], capture_output=True, text=True, timeout=60,
                                          check=True).stdout)[0]
    published = {binding.get("HostPort") for bindings in (inspected.get("NetworkSettings", {}).get("Ports") or {}).values()
                 for binding in (bindings or [])}
    if str(ACCEPT_PORT) not in published:
        refuse(f"{CONTAINER} does not publish {ACCEPT_PORT}")
    if not any(os.path.realpath(m.get("Source", "")) == os.path.realpath(HOST_ROOT) and m.get("Destination") == CONTAINER_ROOT
               and m.get("RW") for m in inspected.get("Mounts") or []):
        refuse("JFMOD_HOST_ROOT is not the read-write mount at JFMOD_CONTAINER_ROOT")


guard_target()


def write_private(path, data):
    """Writes a 0600 file atomically: a private temporary file in the same folder, written in full and flushed, then renamed
    over the old one and the folder flushed, so a killed run or a power cut leaves either the previous content or the new
    one, never a partial file (final web review 2, P3 9; Pi review 1, P3 6)."""
    folder = os.path.dirname(path)
    os.makedirs(folder, mode=0o700, exist_ok=True)
    temporary = f"{path}.{os.getpid()}.tmp"
    payload = memoryview(data.encode())
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        try:
            while payload:
                payload = payload[os.write(fd, payload):]
            os.fsync(fd)
        finally:
            os.close(fd)
        os.replace(temporary, path)
    except BaseException:
        # Whatever failed, the temporary file goes; the previous manifest is untouched (Pi review 2, P3 4).
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise
    directory = os.open(folder, os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


MANIFEST = os.path.join(STATE, "fixture-manifest.json")


def recorded():
    if not os.path.exists(MANIFEST):
        return None
    os.chmod(MANIFEST, 0o600)  # an existing manifest is made private too
    return json.load(open(MANIFEST))


# A run's identity is the one its manifest records; a command before anything is recorded starts a new one, which the
# first creating command writes down with what it creates, so every later command of the same run uses it.
RUN = (recorded() or {}).get("run") or os.urandom(4).hex()


def manifest():
    """What this run created so far."""
    return recorded() or {"run": RUN, "folder": None, "library": None, "entries": []}


def remember(**changes):
    current = manifest()
    current.update(changes)
    write_private(MANIFEST, json.dumps(current))
    return current
FIXTURE_DIR = f"review-{RUN}"
MOVIES = f"{FIXTURE_DIR}/movies"
LIBRARY = f"JellyfinMod Review Movies {RUN}"


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


def library():
    for _ in range(40):
        found = next((f for f in must("GET", "/Library/VirtualFolders") if f["Name"] == LIBRARY), None)
        if found is None or found.get("ItemId"):
            return found
        time.sleep(3)
    sys.exit(f"library {LIBRARY} never got an item id")


def scan():
    must("POST", "/Library/Refresh")
    wait_scan()
    print("reconcile", run_task("JellyfinModCatalogReconciliation"))


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


def cmd_media():
    root = os.path.join(HOST_ROOT, FIXTURE_DIR)
    if os.path.exists(root) and manifest().get("folder") != FIXTURE_DIR:
        sys.exit(f"REFUSED: {FIXTURE_DIR} already exists and is not this run's")
    remember(folder=FIXTURE_DIR)
    folder = os.path.join(HOST_ROOT, MOVIES, TITLE)
    os.makedirs(folder, exist_ok=True)
    for key, name in FILES.items():
        target = os.path.join(folder, name)
        if not os.path.exists(target):
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=duration=6:size=1280x720:rate=5",
                            "-f", "lavfi", "-i", "sine=frequency=440:duration=6", "-c:v", "libx264", "-preset", "ultrafast",
                            "-c:a", "aac", "-shortest", "-metadata", f"title=JellyfinMod Review {key}", target], check=True)
    print("fixtures", len(os.listdir(folder)), "files")


def cmd_library():
    existing = library()
    if existing is not None and manifest().get("library") != LIBRARY:
        sys.exit(f"REFUSED: the library {LIBRARY} already exists and is not this run's")
    if existing is None:
        remember(library=LIBRARY)
        query = urllib.parse.urlencode({"name": LIBRARY, "collectionType": "movies", "refreshLibrary": "true"})
        must("POST", f"/Library/VirtualFolders?{query}", {"LibraryOptions": {
            "EnableRealtimeMonitor": False, "EnableInternetProviders": False,
            "TypeOptions": [{"Type": "Movie", "MetadataFetchers": [], "ImageFetchers": []}],
            "PathInfos": [{"Path": f"{CONTAINER_ROOT}/{MOVIES}"}]}})
        wait_scan()
    scan()


def cmd_entry():
    """The fixture's entry and versions, for the browser runner: ids and labels only."""
    lib = library()
    items = must("GET", f"/JellyfinMod/Entries?targetLibraryId={lib['ItemId']}&limit=100")["items"]
    entry = next((e for e in items if e["tmdbId"] == TMDB), None)
    check(entry is not None, "the review fixture has a catalog entry")
    detail = must("GET", f"/JellyfinMod/Entries/{entry['id']}")
    versions = detail.get("versions") or []
    print(json.dumps({"entryId": entry["id"], "itemId": entry.get("jellyfinItemId"),
                      "versions": [{"bindingId": v["bindingId"], "label": v.get("label")} for v in versions]}))


WANTED_TMDB = 603  # A real TMDB movie added without a file, so the review library has a catalog-only entry.


def library_entries(library_id):
    """Every catalog entry of a library, page by page, so an entry beyond the first page is still seen."""
    entries, start = [], 0
    while True:
        page = must("GET", f"/JellyfinMod/Entries?targetLibraryId={library_id}&startIndex={start}&limit=200")
        entries += page["items"]
        start += len(page["items"])
        if not page["items"] or start >= page.get("totalRecordCount", start):
            return entries


def created_entry(body, what):
    """The entry an add returned, only when the add created it: an existing entry (added concurrently, or missed by the
    look-up) is never recorded as this run's, so cleanup can never delete it (final Pi review, P2 1)."""
    status, answer = call("POST", "/JellyfinMod/Entries", body)
    check(status in (200, 201), f"{what} was added ({status})")
    if not answer.get("created"):
        sys.exit(f"REFUSED: {what} already exists in the catalog and is not this run's")
    return answer["entry"]


def cmd_wanted():
    """A file-less catalog entry in the review library (whole-review chunk 4c, P2 1): its id."""
    lib = library()
    entry = next((e for e in library_entries(lib["ItemId"]) if e["tmdbId"] == WANTED_TMDB), None)
    if entry is not None and entry["id"] not in manifest()["entries"]:
        sys.exit("REFUSED: that wanted entry is already in the catalog and is not this run's")
    if entry is None:
        entry = created_entry({"mediaType": "movie", "tmdbId": WANTED_TMDB, "targetLibraryId": lib["ItemId"]}, "the wanted entry")
        remember(entries=manifest()["entries"] + [entry["id"]])
    print(json.dumps({"wantedEntryId": entry["id"], "libraryId": lib["ItemId"]}))


WANTED_SERIES_TMDB = 1396  # A real TMDB series added to the instance's own TV library, every episode still wanted.


def cmd_wantedseries():
    """A file-less series in the TV library, for the release picker's episode searches; removed by cleanup."""
    shows = next(f for f in must("GET", "/Library/VirtualFolders") if f.get("CollectionType") == "tvshows")
    entry = next((e for e in library_entries(shows["ItemId"]) if e["tmdbId"] == WANTED_SERIES_TMDB), None)
    if entry is None:
        entry = created_entry({"mediaType": "series", "tmdbId": WANTED_SERIES_TMDB, "targetLibraryId": shows["ItemId"]},
                              "the wanted series")
        remember(entries=manifest()["entries"] + [entry["id"]])
    elif entry["id"] not in manifest()["entries"]:
        sys.exit("REFUSED: that series is already in the catalog and is not this run's")
    print(json.dumps({"wantedSeriesId": entry["id"]}))


def views():
    user = next(u for u in must("GET", "/Users") if u["Name"] == ADMIN)["Id"]
    return [view["Name"] for view in must("GET", f"/UserViews?userId={user}")["Items"]]


def cmd_cleanup():
    """Only what the manifest records: files first while the library exists (absence is provable), then the library's own
    entries and the recorded ones, then the library and the folder."""
    recorded = manifest()
    folder = recorded.get("folder")
    if folder:
        movies = os.path.join(HOST_ROOT, folder, "movies")
        if os.path.isdir(movies):
            for name in os.listdir(movies):
                subprocess.run(["rm", "-rf", "--", os.path.join(movies, name)], check=True)
            open(os.path.join(movies, "jfmod-placeholder.txt"), "w").close()
    own = library() if recorded.get("library") == LIBRARY else None
    if own is not None:
        scan()
        for page in range(0, 5000, 200):
            items = must("GET", f"/JellyfinMod/Entries?targetLibraryId={own['ItemId']}&limit=200&startIndex={page}")["items"]
            for item in items:
                status, _ = call("DELETE", f"/JellyfinMod/Entries/{item['id']}")
                check(status in (200, 204), f"cleanup removed this run's entry {item['title']}")
            if len(items) < 200:
                break
    for entry_id in recorded.get("entries", []):
        status, _ = call("DELETE", f"/JellyfinMod/Entries/{entry_id}")
        check(status in (200, 204, 404), f"cleanup removed this run's recorded entry ({status})")
    if own is not None:
        # With refreshLibrary=false Jellyfin keeps the library's view in /UserViews after the folder is gone.
        must("DELETE", f"/Library/VirtualFolders?name={urllib.parse.quote(LIBRARY)}&refreshLibrary=true")
    if folder:
        subprocess.run(["rm", "-rf", "--", os.path.join(HOST_ROOT, folder)], check=True)
    must("POST", "/Library/Refresh")
    wait_scan()
    remaining = views()
    clean = library() is None and not (folder and os.path.exists(os.path.join(HOST_ROOT, folder))) and \
        not any(name.startswith("JellyfinMod") for name in remaining)
    if clean and os.path.exists(MANIFEST):
        os.remove(MANIFEST)
    check(clean, f"cleanup: no review library or fixture left; /UserViews: {remaining}")


def cmd_views():
    print("/UserViews:", views())


COMMANDS = {"login": cmd_login, "media": cmd_media, "library": cmd_library, "entry": cmd_entry, "cleanup": cmd_cleanup, "wanted": cmd_wanted, "wantedseries": cmd_wantedseries,
            "views": cmd_views, "logout": cmd_logout}
if len(sys.argv) != 2 or sys.argv[1] not in COMMANDS:
    sys.exit(__doc__)
COMMANDS[sys.argv[1]]()
