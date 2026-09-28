#!/usr/bin/env python3
"""Live acceptance of V1, versions on Jellyfin 12 (docs/jellyfinmod/V1.md, S7 rows 1-11), on the acceptance instance.

Runs on the host of the acceptance instance against disposable fixtures only (titles `JellyfinMod V1 ...` under a
writable fixture root). It refuses any instance but the acceptance container on its port. The session token is kept in
a 0600 file and never printed.

Environment:
  JFMOD_BASE            base URL of the acceptance instance (port 28096)
  JFMOD_STATE_DIR       private directory for the token, saved settings and evidence (created 0700)
  JFMOD_HOST_ROOT       host directory the container mounts read-write as JFMOD_CONTAINER_ROOT
  JFMOD_CONTAINER_ROOT  the same directory as the container sees it
  JFMOD_CONTAINER       the container (optional, jellyfinmod-acceptance)
  JFMOD_USER            administrator to sign in as (optional, oleksii; empty password)

Subcommands (scenario order): login | health | media | library | reconcile | versions | row2 | row3 | row4 | row5-merge |
  absent-hide | absent-show | absent-delete | save | protect | retention-on MIN | act | due-check | run | double-watch |
  retention-restore | remove KEY | refusals | state | hashes LABEL | compare A B | cleanup | logout | make KEY,KEY
"""
import hashlib, json, os, subprocess, sys, time, urllib.error, urllib.parse, urllib.request

BASE = os.environ["JFMOD_BASE"].rstrip("/")
STATE = os.environ["JFMOD_STATE_DIR"]
HOST_ROOT = os.environ["JFMOD_HOST_ROOT"].rstrip("/")
CONTAINER_ROOT = os.environ["JFMOD_CONTAINER_ROOT"].rstrip("/")
CONTAINER = os.environ.get("JFMOD_CONTAINER", "jellyfinmod-acceptance")
ADMIN = os.environ.get("JFMOD_USER", "oleksii")
TOKEN_FILE = os.path.join(STATE, "token")
RESTORE = os.path.join(STATE, "restore.json")
PLUGIN = "6f1a2b3c4d5e4f609a718b2c3d4e5f60"
AUTH = 'MediaBrowser Client="JellyfinMod V1 live", Device="v1-live", DeviceId="jfmod-v1-live", Version="1"'
ACCEPT_PORT = 28096
ACCEPT_CONTAINER = "jellyfinmod-acceptance"

FIXTURE_DIR = "v1"
MOVIES = f"{FIXTURE_DIR}/movies"
SHOWS = f"{FIXTURE_DIR}/shows"
MOVIE_LIBRARY = "JellyfinMod V1 Movies"
SHOW_LIBRARY = "JellyfinMod V1 Shows"
SERIES = "JellyfinMod V1 Show (2020) [tmdbid-9900100]"


def movie_dir(name, year, tmdb):
    return f"JellyfinMod V1 {name} ({year}) [tmdbid-{tmdb}]"


# key: (directory under the fixture root, file name, width, height, hdr, created by `media`)
TITLES = {
    "Low": movie_dir("Low", 2001, 9900001), "High": movie_dir("High", 2002, 9900002),
    "Remove": movie_dir("Remove", 2003, 9900003), "Finish": movie_dir("Finish", 2004, 9900004),
    "Absent": movie_dir("Absent", 2005, 9900005), "Prefer": movie_dir("Prefer", 2006, 9900006),
}
TMDB = {"Low": 9900001, "High": 9900002, "Remove": 9900003, "Finish": 9900004, "Absent": 9900005, "Prefer": 9900006}
SEASON = f"{SHOWS}/{SERIES}/Season 01"
FIXTURE = {
    "Low-1080p": (f"{MOVIES}/{TITLES['Low']}", f"{TITLES['Low']} - 1080p.mkv", 1920, 1080, False, True),
    "Low-720p": (f"{MOVIES}/{TITLES['Low']}", f"{TITLES['Low']} - 720p.mkv", 1280, 720, False, False),
    "High-720p": (f"{MOVIES}/{TITLES['High']}", f"{TITLES['High']} - 720p.mkv", 1280, 720, False, True),
    "High-2160p": (f"{MOVIES}/{TITLES['High']}", f"{TITLES['High']} - 2160p.mkv", 3840, 2160, False, False),
    "Remove-2160p": (f"{MOVIES}/{TITLES['Remove']}", f"{TITLES['Remove']} - 2160p.mkv", 3840, 2160, False, True),
    "Remove-1080p": (f"{MOVIES}/{TITLES['Remove']}", f"{TITLES['Remove']} - 1080p.mkv", 1920, 1080, False, True),
    "Remove-720p": (f"{MOVIES}/{TITLES['Remove']}", f"{TITLES['Remove']} - 720p.mkv", 1280, 720, False, True),
    "Finish-1080p": (f"{MOVIES}/{TITLES['Finish']}", f"{TITLES['Finish']} - 1080p.mkv", 1920, 1080, False, True),
    "Finish-720p": (f"{MOVIES}/{TITLES['Finish']}", f"{TITLES['Finish']} - 720p.mkv", 1280, 720, False, True),
    "Absent-1080p": (f"{MOVIES}/{TITLES['Absent']}", f"{TITLES['Absent']} - 1080p.mkv", 1920, 1080, False, True),
    "Absent-720p": (f"{MOVIES}/{TITLES['Absent']}", f"{TITLES['Absent']} - 720p.mkv", 1280, 720, False, True),
    "Prefer-2160p": (f"{MOVIES}/{TITLES['Prefer']}", f"{TITLES['Prefer']} - 2160p HDR.mkv", 3840, 2160, True, True),
    "Prefer-1080p": (f"{MOVIES}/{TITLES['Prefer']}", f"{TITLES['Prefer']} - 1080p.mkv", 1920, 1080, False, True),
    "Prefer-720p": (f"{MOVIES}/{TITLES['Prefer']}", f"{TITLES['Prefer']} - 720p.mkv", 1280, 720, False, True),
    "E01-1080p": (SEASON, "JellyfinMod V1 Show (2020) S01E01 - 1080p.mkv", 1920, 1080, False, True),
    "E01-720p": (SEASON, "JellyfinMod V1 Show (2020) S01E01 - 720p.mkv", 1280, 720, False, True),
    "E02": (SEASON, "JellyfinMod V1 Show (2020) S01E02.mkv", 1280, 720, False, True),
    "E02-E03": (SEASON, "JellyfinMod V1 Show (2020) S01E02-E03.mkv", 1280, 720, False, True),
    "E04": (SEASON, "JellyfinMod V1 Show (2020) S01E04.mkv", 1280, 720, False, True),
    "E05": (SEASON, "JellyfinMod V1 Show (2020) S01E05.mkv", 1280, 720, False, True),
    "E06-E07": (SEASON, "JellyfinMod V1 Show (2020) S01E06-E07.mkv", 1280, 720, False, False),
}
SIDECARS = {  # beside Remove: they and the folder must stay byte-identical through Remove this version (decision 3)
    "Remove-srt": (f"{MOVIES}/{TITLES['Remove']}", f"{TITLES['Remove']} - 1080p.en.srt"),
    "Remove-nfo": (f"{MOVIES}/{TITLES['Remove']}", "movie.nfo"),
    "Remove-poster": (f"{MOVIES}/{TITLES['Remove']}", "poster.jpg"),
}


def refuse(reason):
    sys.exit(f"REFUSED (not the acceptance instance): {reason}")


def guard_target():
    if urllib.parse.urlsplit(BASE).port != ACCEPT_PORT:
        refuse(f"JFMOD_BASE must use port {ACCEPT_PORT}")
    if CONTAINER != ACCEPT_CONTAINER:
        refuse(f"JFMOD_CONTAINER must be {ACCEPT_CONTAINER}")
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


def host_path(key):
    directory, name = (FIXTURE.get(key) or SIDECARS[key])[:2]
    return os.path.join(HOST_ROOT, directory, name)


def container_path(key):
    directory, name = (FIXTURE.get(key) or SIDECARS[key])[:2]
    return f"{CONTAINER_ROOT}/{directory}/{name}"


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
    for attempt in range(1, 5 if method == "GET" else 2):
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


def user_id():
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


def sha(path):
    if not os.path.exists(path):
        return "ABSENT"
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def make_video(key):
    _, _, width, height, hdr, _ = FIXTURE[key]
    target = host_path(key)
    os.makedirs(os.path.dirname(target), exist_ok=True)
    if os.path.exists(target):
        return
    video = ["-c:v", "libx264", "-preset", "ultrafast"]
    if hdr:  # HDR10 signalling, so Jellyfin reports the copy's range as HDR
        video = ["-c:v", "libx265", "-preset", "ultrafast", "-pix_fmt", "yuv420p10le", "-color_primaries", "bt2020",
                 "-color_trc", "smpte2084", "-colorspace", "bt2020nc",
                 "-x265-params", "colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc:log-level=error"]
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"testsrc=duration=6:size={width}x{height}:rate=5",
                    "-f", "lavfi", "-i", "sine=frequency=440:duration=6", *video, "-c:a", "aac", "-shortest",
                    "-metadata", f"title=JellyfinMod V1 {key}", target], check=True)


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
    print("version", health.get("Version"), "status", health.get("Status"))
    check({"versions", "versions.v1", "versions.remove"} <= caps, "Health lists versions, versions.v1 and versions.remove")


def cmd_media():
    for key, spec in FIXTURE.items():
        if spec[5]:
            make_video(key)
    directory = os.path.join(HOST_ROOT, SIDECARS["Remove-srt"][0])
    with open(host_path("Remove-srt"), "w") as handle:
        handle.write("1\n00:00:00,000 --> 00:00:02,000\nJellyfinMod V1 sidecar\n")
    with open(host_path("Remove-nfo"), "w") as handle:
        handle.write('<?xml version="1.0" encoding="utf-8"?>\n<movie><title>JellyfinMod V1 Remove</title></movie>\n')
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=200x300", "-frames:v", "1",
                    host_path("Remove-poster")], check=True)
    print("fixtures", sum(os.path.exists(host_path(key)) for key in FIXTURE), "files in", directory.replace(HOST_ROOT, "<root>"))


def library_options(paths):
    return {"LibraryOptions": {"EnableRealtimeMonitor": False, "EnableInternetProviders": False,
                               "TypeOptions": [{"Type": t, "MetadataFetchers": [], "ImageFetchers": []}
                                               for t in ("Series", "Season", "Episode", "Movie")],
                               "PathInfos": [{"Path": p} for p in paths]}}


def cmd_library():
    for name, kind, path in ((MOVIE_LIBRARY, "movies", f"{CONTAINER_ROOT}/{MOVIES}"),
                             (SHOW_LIBRARY, "tvshows", f"{CONTAINER_ROOT}/{SHOWS}")):
        if library(name) is None:
            query = urllib.parse.urlencode({"name": name, "collectionType": kind, "refreshLibrary": "true"})
            must("POST", f"/Library/VirtualFolders?{query}", library_options([path]))
        wait_scan()
    scan()


def scan():
    """A full library scan, then the catalog reconciliation, so bindings and absence reflect what Jellyfin now lists."""
    must("POST", "/Library/Refresh")
    wait_scan()
    print("reconcile", run_task("JellyfinModCatalogReconciliation"))


def entry(title_key):
    lib = library(MOVIE_LIBRARY)
    items = must("GET", f"/JellyfinMod/Entries?targetLibraryId={lib['ItemId']}&limit=100")["items"]
    found = next((e for e in items if e["tmdbId"] == TMDB[title_key]), None)
    return must("GET", f"/JellyfinMod/Entries/{found['id']}") if found else None


def series_entry():
    lib = library(SHOW_LIBRARY)
    items = must("GET", f"/JellyfinMod/Entries?targetLibraryId={lib['ItemId']}&limit=100")["items"]
    found = next((e for e in items if e["tmdbId"] == 9900100), None)
    return must("GET", f"/JellyfinMod/Entries/{found['id']}") if found else None


def media_sources(item_id):
    """Jellyfin's own list of versions for an item: PlaybackInfo's media sources, by path."""
    info = must("POST", f"/Items/{item_id}/PlaybackInfo?userId={user_id()}", {})
    return {source["Path"]: source["Id"] for source in info.get("MediaSources") or []}


def movie_item(title_key):
    lib = library(MOVIE_LIBRARY)
    items = must("GET", f"/Items?ParentId={lib['ItemId']}&Recursive=true&IncludeItemTypes=Movie&Fields=Path")["Items"]
    return next((i for i in items if TITLES[title_key] in (i.get("Path") or "")), None)


def rows(versions):
    return {v["mediaSourceId"]: v for v in versions or []}


def compare_title(label, versions, sources):
    """Row 1: every file Jellyfin plays for the title is a tracked version row with the same media source id."""
    by_source = rows(versions)
    missing = [path for path, source in sources.items() if source not in by_source]
    untracked = [path for path, source in sources.items() if by_source.get(source, {}).get("tracked") is False]
    check(not missing and not untracked and len(versions) == len(sources),
          f"{label}: {len(sources)} media sources, {len(versions)} version rows, all tracked")
    defaults = [v for v in versions if v["isDefault"]]
    check(len(defaults) == 1, f"{label}: exactly one Default row")


def cmd_versions():
    for key in ("Low", "High", "Remove", "Finish", "Absent", "Prefer"):
        detail, item = entry(key), movie_item(key)
        if not detail or not item:
            print("SKIP", key, "not in the library")
            continue
        compare_title(key, detail.get("versions"), media_sources(item["Id"]))
    series = series_entry()
    for episode in series["episodes"]:
        if episode.get("versions"):
            main = next(v for v in episode["versions"] if v["isDefault"])
            compare_title(f"S{episode['seasonNumber']:02}E{episode['episodeNumber']:02}", episode["versions"],
                          media_sources(main["jellyfinItemId"]))
    notld = next((e for e in all_entries() if e["tmdbId"] == 10331), None)
    if notld:
        detail = must("GET", f"/JellyfinMod/Entries/{notld['id']}")
        compare_title("Night of the Living Dead (read only)", detail.get("versions"),
                      media_sources(detail["entry"]["jellyfinItemId"]))


def history(detail, event):
    return [h for h in detail["history"] if h["eventType"] == event]


def binding_snapshot(title_key):
    detail = entry(title_key)
    return {v["mediaSourceId"]: {"bindingId": v["bindingId"], "default": v["isDefault"]} for v in detail["versions"]}, detail


def cmd_add(key):
    make_video(key)
    print("added", key)


def cmd_row(title_key, add_key):
    """Rows 2 and 3: a version added second keeps the first file's binding (and, when it becomes the main version, the
    old main follows it as an extra version); nothing is lost and no media_missing is written."""
    before, detail_before = binding_snapshot(title_key)
    missing_before = len(history(detail_before, "media_missing"))
    make_video(add_key)
    scan()
    after, detail = binding_snapshot(title_key)
    kept = all(source in after and after[source]["bindingId"] == value["bindingId"] for source, value in before.items())
    check(kept and len(after) == len(before) + 1, f"{title_key}: the first file keeps its binding, the new file is bound "
          f"({len(before)} -> {len(after)} versions)")
    check(len(history(detail, "media_missing")) == missing_before, f"{title_key}: no media_missing")
    print("defaults before", [s for s, v in before.items() if v["default"]], "after", [s for s, v in after.items() if v["default"]])
    print("history", [h["eventType"] for h in detail["history"][:5]])
    item = movie_item(title_key)
    compare_title(title_key, detail["versions"], media_sources(item["Id"]))


def episode(series, number):
    return next(e for e in series["episodes"] if e["seasonNumber"] == 1 and e["episodeNumber"] == number)


def cmd_row4():
    series = series_entry()
    e01 = episode(series, 1)
    check(len(e01["versions"]) == 2 and all(v["tracked"] is not False for v in e01["versions"]),
          "S01E01: two files, one episode, both tracked")
    e02, e03 = episode(series, 2), episode(series, 3)
    ranges = [v.get("episodeRange") for v in e02["versions"]]
    check(len(e02["versions"]) == 2 and "S01E02-E03" in ranges, "S01E02: its own file and S01E02-E03 are its versions")
    double = next(v for v in e02["versions"] if v.get("episodeRange"))
    check(e03["jellyfinItemId"] is not None and e03["jellyfinItemId"].replace("-", "") == double["mediaSourceId"],
          "S01E03 is on the series page and points at the double file (covered, no file of its own; review P2-6)")


def item_by_path(key):
    items = must("GET", f"/Items?ParentId={library(SHOW_LIBRARY)['ItemId']}&Recursive=true&IncludeItemTypes=Episode&Fields=Path")
    return next((i for i in items["Items"] if i.get("Path") == container_path(key)), None)


def cmd_merge():
    """Row 6: two different episodes grouped through stock Group versions are refused as a whole."""
    e04, e05 = item_by_path("E04"), item_by_path("E05")
    must("POST", f"/Videos/MergeVersions?ids={e04['Id']},{e05['Id']}")
    scan()
    series = series_entry()
    four, five = episode(series, 4), episode(series, 5)
    print("E04 versions", len(four["versions"]), "E05 versions", len(five["versions"]))


def cmd_absent(step):
    """Row 8: a bound file Jellyfin stops listing while it is on disk keeps its binding; once it is gone, the binding goes."""
    folder = os.path.join(HOST_ROOT, MOVIES, TITLES["Absent"])
    ignore = os.path.join(folder, ".ignore")
    if step == "hide":
        with open(ignore, "w") as handle:
            handle.write("*720p*\n")
    elif step == "show":
        os.remove(ignore)
    elif step == "delete":
        os.remove(host_path("Absent-720p"))
    scan()
    detail = entry("Absent")
    item = movie_item("Absent")
    sources = media_sources(item["Id"]) if item else {}
    print(step, "jellyfin sources", len(sources), "rows", [(v["mediaSourceId"][:8], v["tracked"]) for v in detail["versions"]],
          "history", [h["eventType"] for h in detail["history"][:4]])
    if step == "hide":
        check(container_path("Absent-720p") not in sources and len(detail["versions"]) == 2,
              "Absent: Jellyfin no longer lists the 720p, which is on disk; its binding stays")
    elif step == "show":
        compare_title("Absent", detail["versions"], sources)
    else:
        check(len(detail["versions"]) == 1 and container_path("Absent-720p") not in sources,
              "Absent: the 720p is gone from disk, so its binding went")


def all_hashes():
    result = {key: sha(host_path(key)) for key in list(FIXTURE) + list(SIDECARS)}
    remove_dir = os.path.join(HOST_ROOT, MOVIES, TITLES["Remove"])
    result["Remove-folder"] = os.path.isdir(remove_dir)
    return result


def cmd_hashes(label):
    write_private(os.path.join(STATE, f"hashes-{label}.json"), json.dumps(all_hashes(), indent=1))
    print("hashes", label, "saved")


REWRITTEN = {"Remove-nfo"}


def cmd_compare(before, after, expect_gone):
    a = json.load(open(os.path.join(STATE, f"hashes-{before}.json")))
    b = json.load(open(os.path.join(STATE, f"hashes-{after}.json")))
    gone = {key for key in a if a[key] != "ABSENT" and b.get(key) == "ABSENT"}
    # Jellyfin's NFO saver (on for this instance's libraries) rewrites movie.nfo whenever the movie changes, with the
    # streams of the files that remain; the file stays, and staying is what is checked for it.
    changed = {key for key in a if a[key] not in ("ABSENT",) and b.get(key) not in ("ABSENT", a[key]) and key not in REWRITTEN}
    for key in REWRITTEN & set(a):
        if a[key] != "ABSENT":
            check(b.get(key) != "ABSENT", f"{key} stays (Jellyfin rewrote it: {b.get(key) != a[key]})")
    expected = set(filter(None, expect_gone.split(",")))
    check(gone == expected and not changed, f"{before} -> {after}: gone {sorted(gone)} (expected {sorted(expected)}), "
          f"every other file byte-identical" + (f"; CHANGED {sorted(changed)}" if changed else ""))


def version_row(title_key, file_key):
    detail = entry(title_key)
    item = movie_item(title_key)
    sources = media_sources(item["Id"]) if item else {}
    source = sources.get(container_path(file_key))
    return detail, next((v for v in detail["versions"] if v["mediaSourceId"] == (source or "").replace("-", "")), None)


def cmd_remove(title_key, file_key):
    """Rows 9 and 10: Remove this version deletes exactly one file."""
    cmd_hashes("before-" + file_key)
    detail, row = version_row(title_key, file_key)
    check(row is not None and row["removable"], f"{file_key}: removable row found (isLast={row and row['isLast']})")
    result = must("POST", f"/JellyfinMod/Entries/{detail['entry']['id']}/Versions/{row['bindingId']}/Remove")
    print("removed", json.dumps(result))
    cmd_hashes("after-" + file_key)
    cmd_compare("before-" + file_key, "after-" + file_key, file_key)
    check(os.path.isdir(os.path.join(HOST_ROOT, MOVIES, TITLES[title_key])), f"{title_key}: the folder stays")
    scan()
    detail = entry(title_key)
    print("state", detail["entry"]["state"], "monitored", detail["entry"]["monitored"], "versions", len(detail["versions"]),
          "history", [h["eventType"] for h in detail["history"][:4]])
    check(not history(detail, "media_missing"), f"{title_key}: no media_missing after a full scan")
    if row["isLast"]:
        check(detail["entry"]["state"] == "none" and not detail["entry"]["monitored"] and movie_item(title_key) is None,
              f"{title_key}: not downloaded, unmonitored, no native item after a full scan")
    else:
        check(detail["entry"]["state"] == "onDisk", f"{title_key}: still on disk with its other versions")


def cmd_remove_episode_file(key, covered):
    """Row 10b: removing the last copy of a multi-episode file leaves every episode it held not downloaded and unmonitored."""
    item = item_by_path(key)
    check(item is not None, f"{key}: native item found")
    series = series_entry()
    owner = next(e for e in series["episodes"] if any(v["mediaSourceId"] == item["Id"].replace("-", "") for v in e.get("versions") or []))
    row = next(v for v in owner["versions"] if v["mediaSourceId"] == item["Id"].replace("-", ""))
    print("removing", key, "from", f"S01E{owner['episodeNumber']:02}", "isLast", row["isLast"], "range", row.get("episodeRange"))
    cmd_hashes("before-" + key)
    result = must("POST", f"/JellyfinMod/Entries/{series['entry']['id']}/Versions/{row['bindingId']}/Remove")
    print("removed", json.dumps(result))
    cmd_hashes("after-" + key)
    cmd_compare("before-" + key, "after-" + key, key)
    scan()
    series = series_entry()
    for number in [int(n) for n in covered.split(",")]:
        e = episode(series, number)
        check(e["state"] == "none" and not e["monitored"], f"S01E{number:02}: not downloaded and unmonitored ({e['state']}, "
              f"monitored={e['monitored']})")


def cmd_refusals():
    """Row 11: anonymous 401, an ordinary user is covered by the security sweep; a kept file 409 version_kept."""
    detail, row = version_row("Low", "Low-720p")
    path = f"/JellyfinMod/Entries/{detail['entry']['id']}/Versions/{row['bindingId']}/Remove"
    status, _ = call("POST", path, anonymous=True)
    check(status == 401, f"anonymous Remove -> {status}")
    must("POST", f"/JellyfinMod/Entries/{detail['entry']['id']}/Versions/{row['bindingId']}/Keep")
    status, body = call("POST", path)
    check(status == 409 and "version_kept" in str(body), f"kept file Remove -> {status} {str(body)[:120]}")
    must("DELETE", f"/JellyfinMod/Entries/{detail['entry']['id']}/Versions/{row['bindingId']}/Keep")
    check(sha(host_path("Low-720p")) != "ABSENT", "the kept file is still there")


def cmd_state():
    for key in TITLES:
        detail = entry(key)
        if detail:
            print(key, detail["entry"]["state"], [(v["resolution"], v["isDefault"], v["tracked"], v["retention"])
                                                   for v in detail["versions"]])
    series = series_entry()
    if series:
        for e in series["episodes"]:
            print(f"S01E{e['episodeNumber']:02}", e["state"], [(v["resolution"], v.get("episodeRange"), v["tracked"],
                                                                v["retention"]) for v in e.get("versions") or []])


# --- retention session (rows 5, 6 and 7): switched on for the session only and restored ---

def cmd_save():
    if os.path.exists(RESTORE):
        sys.exit("restore file exists; not overwriting")
    saved = {"retention": must("GET", "/JellyfinMod/Settings/Retention"),
             "testWindowMinutes": must("GET", f"/Plugins/{PLUGIN}/Configuration").get("RetentionTestWindowMinutes", 0),
             "keeps": []}
    write_private(RESTORE, json.dumps(saved))
    print("saved: retention enabled", saved["retention"]["enabled"], "window", saved["testWindowMinutes"])


def fixture_libraries():
    """The item ids of the two disposable V1 libraries; everything else on the instance is protected."""
    return {lib["ItemId"].replace("-", "").lower() for lib in (library(MOVIE_LIBRARY), library(SHOW_LIBRARY)) if lib}


def is_fixture(library_id, path, fixtures):
    """A binding is a fixture only when it is in a V1 library AND its file is under the V1 fixture folder."""
    return ((library_id or "").replace("-", "").lower() in fixtures
            and (path or "").startswith(f"{CONTAINER_ROOT}/{FIXTURE_DIR}/"))


def all_entries():
    """Every catalog entry, page by page (the list returns at most 200 per request)."""
    found, start = [], 0
    while True:
        page = must("GET", f"/JellyfinMod/Entries?startIndex={start}&limit=200")
        found += page["items"]
        start += len(page["items"])
        if not page["items"] or start >= page["totalRecordCount"]:
            return found


def retention_targets():
    """Every binding retention can act on, movies and episode versions alike: the executor takes its candidates from
    this preview, each with its binding, entry, library and path."""
    return must("GET", "/JellyfinMod/Retention/Preview")["items"]


def container_mounts():
    """The acceptance container's mounts, longest destination first, to find a container path's file on this host."""
    inspected = json.loads(subprocess.run(["docker", "inspect", CONTAINER], capture_output=True, text=True, timeout=60,
                                          check=True).stdout)[0]
    return sorted(((m["Destination"], m["Source"]) for m in inspected.get("Mounts") or []), key=lambda m: -len(m[0]))


def host_identity(path, mounts):
    """(device, inode) of a container path's file on this host, or None when it cannot be read."""
    for destination, source in mounts:
        if path == destination or path.startswith(destination + "/"):
            try:
                st = os.stat(source + path[len(destination):])
                return st.st_dev, st.st_ino
            except OSError:
                return None
    return None


def unprotected():
    """Bindings outside the V1 fixtures that nothing keeps per file, from both the retention preview (what the executor
    sees) and every page of the catalog (each movie version and each episode version)."""
    missing = {}
    fixtures = fixture_libraries()
    targets = retention_targets()
    mounts = container_mounts()
    # A Keep holds a file by path or by identity; a second binding of the same file (the same disk mounted twice) stores
    # no second Keep, and a disabled preview names only the path rule. Such a binding counts as kept only when the host
    # proves it is the same inode as a file this entry keeps, which is the identity rule the executor's preview applies.
    kept_identities = {}
    for item in targets:
        if item.get("reason") == "version_kept" and item.get("path"):
            identity = host_identity(item["path"], mounts)
            if identity:
                kept_identities.setdefault(item["entryId"], set()).add(identity)
    for item in targets:
        if is_fixture(item.get("targetLibraryId"), item.get("path"), fixtures) or item.get("reason") == "version_kept":
            continue
        identity = host_identity(item["path"], mounts) if item.get("path") else None
        if identity and identity in kept_identities.get(item["entryId"], set()):
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
    """Keeps, per file, every binding that is not a V1 fixture before retention is switched on, records each Keep as it
    is made (so a failure part-way still restores), then verifies that nothing outside the fixtures is left unkept."""
    saved = json.load(open(RESTORE))
    recorded = {binding for _, binding in saved["keeps"]}
    for binding_id, (entry_id, _) in unprotected().items():
        if binding_id in recorded:
            continue
        must("POST", f"/JellyfinMod/Entries/{entry_id}/Versions/{binding_id}/Keep")
        saved["keeps"].append([entry_id, binding_id])
        write_private(RESTORE, json.dumps(saved))
    print("kept for the session:", len(saved["keeps"]), "files outside the V1 fixtures")
    verify_protection()


def verify_protection():
    """Refuses (exit) unless every binding outside the V1 fixture libraries is kept per file."""
    missing = unprotected()
    for binding_id, (_, name) in list(missing.items())[:10]:
        print("  not kept:", binding_id, name)
    check(not missing, f"every binding outside the V1 fixtures is kept per file ({len(missing)} not kept)")


def cmd_retention_on(minutes):
    # Global retention with a minute-scale window may reclaim any due binding: never switch it on unprotected.
    verify_protection()
    config = must("GET", f"/Plugins/{PLUGIN}/Configuration")
    config["RetentionTestWindowMinutes"] = int(minutes)
    must("POST", f"/Plugins/{PLUGIN}/Configuration", config)
    retention = must("GET", "/JellyfinMod/Settings/Retention")
    must("PATCH", "/JellyfinMod/Settings/Retention", {"enabled": True, "reclaimAfterDays": 1, "watchedUserMode": "selectedUser",
         "selectedUserId": user_id(), "exemptFavourites": True, "revision": retention["revision"]})
    # The plugin records the switch-on when its listener reads the saved settings; a watch before that does not count.
    time.sleep(20)
    print("retention on: selected user, test window", minutes, "min")


def play_to_end(item_id, source_id=None):
    """Plays an item to its end through the session API, as a client does, so Jellyfin records it played with a date."""
    info = must("GET", f"/Items/{item_id}?userId={user_id()}")
    ticks = info.get("RunTimeTicks") or 60_000_000
    body = {"ItemId": item_id, "MediaSourceId": source_id or item_id, "PositionTicks": 0, "PlayMethod": "DirectPlay",
            "PlaySessionId": "jfmod-v1-" + item_id[:8]}
    must("POST", "/Sessions/Playing", body)
    time.sleep(2)
    must("POST", "/Sessions/Playing/Stopped", dict(body, PositionTicks=ticks))


def cmd_act():
    series = series_entry()
    e02_file = item_by_path("E02")
    play_to_end(e02_file["Id"])  # decision 2: E02 watched through its own single file
    for key in ("E04", "E05"):  # row 6: both merged episodes watched
        play_to_end(item_by_path(key)["Id"])
    finish = movie_item("Finish")
    sources = media_sources(finish["Id"])
    play_to_end(finish["Id"], sources[container_path("Finish-720p")])  # row 7: the non-main version finished
    detail, keep = version_row("Finish", "Finish-1080p")
    must("POST", f"/JellyfinMod/Entries/{detail['entry']['id']}/Versions/{keep['bindingId']}/Keep")
    print("acted: E02 file, E04, E05 and Finish 720p played to the end; Finish 1080p kept per file;",
          "series", series["entry"]["title"])


def cmd_preview():
    preview = must("GET", "/JellyfinMod/Retention/Preview")
    mine = {}
    for item in preview["items"]:
        path = item.get("path") or ""
        if f"{CONTAINER_ROOT}/{FIXTURE_DIR}/" in path:
            mine[path.rsplit("/", 1)[-1]] = (item["state"], item["reason"])
        elif item["state"] == "due":
            sys.exit(f"REFUSED: a title that is not a fixture is due: {path.rsplit('/', 1)[-1]}")
    for name, value in sorted(mine.items()):
        print(" ", name, value)
    return mine


def cmd_run():
    verify_protection()
    cmd_preview()
    print("reclamation", run_task("JellyfinModRetentionReclamation"))


def cmd_retention_restore():
    saved = json.load(open(RESTORE))
    config = must("GET", f"/Plugins/{PLUGIN}/Configuration")
    config["RetentionTestWindowMinutes"] = saved["testWindowMinutes"]
    must("POST", f"/Plugins/{PLUGIN}/Configuration", config)
    retention = must("GET", "/JellyfinMod/Settings/Retention")
    old = saved["retention"]
    must("PATCH", "/JellyfinMod/Settings/Retention", {key: old.get(key) for key in
         ("enabled", "reclaimAfterDays", "watchedUserMode", "selectedUserId", "exemptFavourites")} | {"revision": retention["revision"]})
    for entry_id, binding_id in saved["keeps"]:
        must("DELETE", f"/JellyfinMod/Entries/{entry_id}/Versions/{binding_id}/Keep")
    after = must("GET", "/JellyfinMod/Settings/Retention")
    check(after["enabled"] == saved["retention"]["enabled"], f"retention restored to enabled={after['enabled']}, "
          f"window {saved['testWindowMinutes']}, {len(saved['keeps'])} session keeps removed")
    os.rename(RESTORE, RESTORE + ".done")


def cmd_cleanup():
    for name in (MOVIE_LIBRARY, SHOW_LIBRARY):
        if library(name) is not None:
            must("DELETE", f"/Library/VirtualFolders?name={urllib.parse.quote(name)}&refreshLibrary=false")
    subprocess.run(["rm", "-rf", "--", os.path.join(HOST_ROOT, FIXTURE_DIR)], check=True)
    scan()
    removed = 0
    for item in all_entries():
        if item["title"].startswith("JellyfinMod V1") or item["tmdbId"] in TMDB.values() or item["tmdbId"] == 9900100:
            status, _ = call("DELETE", f"/JellyfinMod/Entries/{item['id']}")
            removed += status in (200, 204)
    left = [i["title"] for i in all_entries() if i["title"].startswith("JellyfinMod")]
    check(not left and not os.path.exists(os.path.join(HOST_ROOT, FIXTURE_DIR)),
          f"cleanup: {removed} entries removed, no JellyfinMod title or fixture file left")


def cmd_latest():
    """The latest reconciliation run: its kind, state and any absence diagnostic naming a fixture."""
    run = must("GET", "/JellyfinMod/Reconciliation/Latest") or {}
    text = json.dumps(run)
    print({key: run.get(key) for key in ("kind", "status", "startedAt", "missingItems", "excludedTitles")})
    for line in [part for part in text.split("\\n") if "V1" in part][:5]:
        print(" ", line[:300])
    print("mentions Absent:", "JellyfinMod V1 Absent" in text, "absence not confirmed:", "Absence was not confirmed" in text)


def cmd_users():
    """Row 11: an ordinary user gets 403; an administrator who cannot read the Shows library gets 404 for an episode's
    version (review P2-5). The disposable user's password is random, kept in a 0600 file and deleted with the user."""
    import secrets
    name = "jfmod-v1-disposable"
    password = secrets.token_urlsafe(24)
    write_private(os.path.join(STATE, "disposable-password"), password)
    created = must("POST", "/Users/New", {"Name": name, "Password": password})
    try:
        policy = must("GET", f"/Users/{created['Id']}")["Policy"]
        status, result = call("POST", "/Users/AuthenticateByName", {"Username": name, "Pw": password}, anonymous=True)
        check(status == 200, "disposable user signs in")
        token = result["AccessToken"]
        series = series_entry()
        e01 = episode(series, 1)
        path = f"/JellyfinMod/Entries/{series['entry']['id']}/Versions/{e01['versions'][1]['bindingId']}/Remove"

        def as_user():
            request = urllib.request.Request(BASE + path, data=b"", method="POST",
                                             headers={"Authorization": AUTH + f', Token="{token}"'})
            try:
                with urllib.request.urlopen(request, timeout=60) as response:
                    return response.status
            except urllib.error.HTTPError as error:
                return error.code

        check(as_user() == 403, "an ordinary user cannot remove a version (403)")
        movies = library(MOVIE_LIBRARY)["ItemId"]
        policy.update({"IsAdministrator": True, "EnableAllFolders": False, "EnabledFolders": [movies]})
        must("POST", f"/Users/{created['Id']}/Policy", policy)
        check(as_user() == 404, "an administrator who cannot read the Shows library gets 404 for its episode's version")
        check(sha(host_path("E01-720p")) != "ABSENT", "the episode's file is untouched")
    finally:
        must("DELETE", f"/Users/{created['Id']}")
        os.remove(os.path.join(STATE, "disposable-password"))
        print("disposable user deleted")


def cmd_debug_low():
    item = movie_item("Low")
    data = must("GET", f"/Items/{item['Id']}?userId={user_id()}")["UserData"]
    print("1080p user data", {k: data.get(k) for k in ("Played", "LastPlayedDate", "PlaybackPositionTicks", "PlayCount")})
    import sqlite3
    db = sqlite3.connect(f"file:{HOST_ROOT}/config/data/jellyfinmod/jellyfinmod.db?mode=ro", uri=True)
    entry_id = entry("Low")["entry"]["id"]
    target = entry_id.replace("-", "").upper()
    for row in db.execute("select UserId, JellyfinItemId, Played, PlaybackPositionTicks, CompletedAt, LastPlayedAt, SourceReason "
                          "from CompletionObservations"):
        if row[1] and row[1].replace("-", "").lower() == item["Id"].replace("-", "").lower():
            print("observation", row[2:])
    print("evaluation", [r for r in db.execute("select State, Reason, BaselineAt, Deadline from RetentionEvaluations") if False][:1])


def cmd_playing_refusal():
    """Row 11: the file being played cannot be removed (409 active_session); another version of the same title can be."""
    item = movie_item("Prefer")
    sources = media_sources(item["Id"])
    source = sources[container_path("Prefer-720p")]
    body = {"ItemId": item["Id"], "MediaSourceId": source, "PositionTicks": 10_000_000, "PlayMethod": "DirectPlay",
            "PlaySessionId": "jfmod-v1-refusal"}
    must("POST", "/Sessions/Playing", body)
    try:
        detail, row = version_row("Prefer", "Prefer-720p")
        status, result = call("POST", f"/JellyfinMod/Entries/{detail['entry']['id']}/Versions/{row['bindingId']}/Remove")
        check(status == 409 and "active_session" in str(result), f"the playing 720p -> {status} {str(result)[:100]}")
    finally:
        must("POST", "/Sessions/Playing/Stopped", dict(body, PositionTicks=0))
    check(sha(host_path("Prefer-720p")) != "ABSENT", "the playing file is untouched")


COMMANDS = {
    "login": cmd_login, "logout": cmd_logout, "health": cmd_health, "media": cmd_media, "library": cmd_library,
    "reconcile": scan, "versions": cmd_versions, "row2": lambda: cmd_row("Low", "Low-720p"),
    "row3": lambda: cmd_row("High", "High-2160p"), "row4": cmd_row4, "merge": cmd_merge,
    "absent-hide": lambda: cmd_absent("hide"), "absent-show": lambda: cmd_absent("show"),
    "absent-delete": lambda: cmd_absent("delete"), "save": cmd_save, "protect": cmd_protect, "act": cmd_act,
    "preview": cmd_preview, "run": cmd_run, "retention-restore": cmd_retention_restore, "refusals": cmd_refusals,
    "state": cmd_state, "cleanup": cmd_cleanup, "latest": cmd_latest, "users": cmd_users, "debug-low": cmd_debug_low,
    "playing-refusal": cmd_playing_refusal, "prefer-id": lambda: print(movie_item("Prefer")["Id"]),
    "run-latest": lambda: print(json.dumps(must("GET", "/JellyfinMod/Retention/Runs/Latest"))[:1500]),
    "scan-only": lambda: (must("POST", "/Library/Refresh"), wait_scan(), time.sleep(30)),
    "double-watch": lambda: play_to_end(item_by_path("E02-E03")["Id"]),
    "high-watch": lambda: play_to_end(movie_item("High")["Id"], media_sources(movie_item("High")["Id"])[container_path("High-720p")]),
    "low-watch": lambda: play_to_end(movie_item("Low")["Id"], media_sources(movie_item("Low")["Id"])[container_path("Low-720p")]),
}

if __name__ == "__main__":
    os.makedirs(STATE, mode=0o700, exist_ok=True)
    name, arguments = sys.argv[1], sys.argv[2:]
    if name == "retention-on":
        cmd_retention_on(arguments[0])
    elif name == "remove":
        cmd_remove(arguments[0], arguments[1])
    elif name == "monitor-episodes":
        make_video(arguments[0])
        scan()
        series = series_entry()
        for number in [int(n) for n in arguments[1].split(",")]:
            e = episode(series, number)
            must("PATCH", f"/JellyfinMod/Entries/{series['entry']['id']}/Episodes/{e['id']}", {"monitored": True})
        series = series_entry()
        check(all(episode(series, int(n))["monitored"] and episode(series, int(n))["state"] == "onDisk"
                  for n in arguments[1].split(",")), f"episodes {arguments[1]} on disk and monitored")
    elif name == "make":
        # Recreates exactly the named fixture files (keys of FIXTURE), then scans; nothing else is created.
        for key in arguments[0].split(","):
            make_video(key)
        scan()
    elif name == "remove-episode-file":
        cmd_remove_episode_file(arguments[0], arguments[1])
    elif name == "monitor":
        detail = entry(arguments[0])
        must("PATCH", f"/JellyfinMod/Entries/{detail['entry']['id']}", {"monitored": True})
        check(entry(arguments[0])["entry"]["monitored"], f"{arguments[0]} is monitored")
    elif name == "hashes":
        cmd_hashes(arguments[0])
    elif name == "compare":
        cmd_compare(arguments[0], arguments[1], arguments[2] if len(arguments) > 2 else "")
    else:
        COMMANDS[name]()
