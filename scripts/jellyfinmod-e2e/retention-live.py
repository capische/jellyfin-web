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

SHOW_LIBRARY = "JellyfinMod P10 Shows"
MOVIE_LIBRARY = "JellyfinMod P10 Movies"
SERIES_TMDB = 1418
MOVIE_TMDB = 603
SERIES_DIR = "JellyfinMod P10 Show (2007) [tmdbid-1418]"
MOVIE_DIR = "JellyfinMod P10 Movie (1999) [tmdbid-603]"
ROOTS = {"A": "tv-p10a", "B": "tv-p10b"}
SEED_DIR = "p10-seed"
MOVIE_ROOT = "movies-p10"

# FIXTURE — key: (root, file name, what the fast run must do to it)
FIXTURE = {
    "E01-A": ("A", "JellyfinMod P10 Show S01E01.mkv", "reclaimed"),        # watched copy of a two-binding episode
    "E01-B": ("B", "JellyfinMod P10 Show S01E01.mkv", "kept"),             # the other copy, kept per file (Q3)
    "E02-A": ("A", "JellyfinMod P10 Show S01E02.mkv", "reclaimed"),        # unwatched copy: any copy watched counts (Q7)
    "E02-B": ("B", "JellyfinMod P10 Show S01E02.mkv", "reclaimed"),        # the watched copy
    "E03": ("A", "JellyfinMod P10 Show S01E03.mkv", "kept"),               # unwatched sibling
    "E04": ("A", "JellyfinMod P10 Show S01E04.mkv", "kept"),               # watched, kept at episode level
    "E05": ("A", "JellyfinMod P10 Show S01E05.mkv", "kept"),               # backlog: played before tracking (Q1)
    "E06": ("A", "JellyfinMod P10 Show S01E06.mkv", "kept"),               # watched, seeding below its goal
    "E07-E08": ("A", "JellyfinMod P10 Show S01E07-E08.mkv", "reclaimed"),  # multi-episode file, fully due (Q5)
    "E09-E10": ("A", "JellyfinMod P10 Show S01E09-E10.mkv", "kept"),       # multi-episode file, E10 not due
    "E10-B": ("B", "JellyfinMod P10 Show S01E10.mkv", "kept"),             # E10's own copy, unwatched
    "E11": ("A", "JellyfinMod P10 Show S01E11.mkv", "kept"),               # grouped with E11-E12 by Jellyfin 12 (C1)
    "E11-E12": ("A", "JellyfinMod P10 Show S01E11-E12.mkv", "kept"),       # E12's only copy
    "E13": ("A", "JellyfinMod P10 Show S01E13.mkv", "reclaimed"),          # watched on another device (synced)
    "E14-A": ("A", "JellyfinMod P10 Show S01E14.mkv", "kept"),             # two bindings, for the per-file Keep UI
    "E14-B": ("B", "JellyfinMod P10 Show S01E14.mkv", "kept"),
    "M-1080p": ("M", "JellyfinMod P10 Movie (1999) [tmdbid-603] - 1080p.mkv", "kept"),  # a two-file movie on Jellyfin 12 (C7)
    "M-720p": ("M", "JellyfinMod P10 Movie (1999) [tmdbid-603] - 720p.mkv", "kept"),
}
SEEDED = ("E06",)
SIDECAR = ("A", "JellyfinMod P10 Show S01E01.en.srt")
NFO = ("A", "JellyfinMod P10 Show S01E01.nfo")  # titles E01 "Pilot", TMDB's own title: evidence for Refresh


def host_dir(root):
    if root == "M":
        return os.path.join(HOST_MEDIA, MOVIE_ROOT, MOVIE_DIR)
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


def must(method, path, body=None, ok=(200, 201, 202, 204), token=None):
    status, result = call(method, path, body, token)
    if status not in ok:
        sys.exit(f"FAIL {method} {path} -> {status} {str(result)[:300]}")
    return result


def check(condition, message):
    print(("PASS " if condition else "FAIL ") + message, flush=True)
    if not condition:
        sys.exit(1)


def library(name):
    return next((f for f in must("GET", "/Library/VirtualFolders") if f["Name"] == name), None)


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
                    "-preset", "ultrafast", "-c:a", "aac", "-shortest", "-metadata", f"title=JellyfinMod P10 {key}",
                    target], check=True)


def cmd_media():
    # A file is created once: running this again adds new fixtures but never brings back a file retention reclaimed.
    marker = os.path.join(STATE, "media-created.json")
    created = set(json.load(open(marker))) if os.path.exists(marker) else set()
    for index, key in enumerate(FIXTURE):
        if key in created:
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
        handle.write("1\n00:00:00,000 --> 00:00:02,000\nJellyfinMod P10 sidecar\n")
    with open(os.path.join(host_dir(NFO[0]), NFO[1]), "w") as handle:
        handle.write("<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<episodedetails><title>Pilot</title>"
                     "<season>1</season><episode>1</episode></episodedetails>\n")
    write_private(marker, json.dumps(sorted(created | set(FIXTURE))))
    print(json.dumps({key: os.stat(host_path(key)).st_nlink for key in FIXTURE if os.path.exists(host_path(key))}))


def library_options(paths):
    return {"LibraryOptions": {"EnableRealtimeMonitor": False, "EnableInternetProviders": False,
                               "TypeOptions": [{"Type": t, "MetadataFetchers": [], "ImageFetchers": []}
                                               for t in ("Series", "Season", "Episode", "Movie")],
                               "PathInfos": [{"Path": p} for p in paths]}}


def cmd_library():
    for name, kind, paths in ((SHOW_LIBRARY, "tvshows", [f"{CONTAINER_MEDIA}/{ROOTS['A']}", f"{CONTAINER_MEDIA}/{ROOTS['B']}"]),
                              (MOVIE_LIBRARY, "movies", [f"{CONTAINER_MEDIA}/{MOVIE_ROOT}"])):
        if library(name) is None:
            query = urllib.parse.urlencode({"name": name, "collectionType": kind, "refreshLibrary": "true"})
            must("POST", f"/Library/VirtualFolders?{query}", library_options(paths))
        else:
            must("POST", f"/Items/{library(name)['ItemId']}/Refresh?Recursive=true")
        wait_scan()
    shows = episodes_by_file()
    print("native episodes", len(shows))
    for path, item in sorted(shows.items()):
        print(" ", path.replace(CONTAINER_MEDIA, "<media>"), "S", item.get("ParentIndexNumber"), "E", item.get("IndexNumber"),
              "-", item.get("IndexNumberEnd"), item["Id"])


def cmd_reconcile():
    print("reconcile", run_task("JellyfinModCatalogReconciliation"))


def cmd_backlog():
    item = native_item("E05")
    must("POST", f"/UserPlayedItems/{item['Id']}?userId={selected_user()}&datePlayed=2026-09-01T10:00:00.000Z")
    print("E05 marked played with a date before tracking")


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
    sync_watch("E13", user)
    # The movie: watch the main version.
    lib, movie = entry(MOVIE_LIBRARY, MOVIE_TMDB)
    movies = must("GET", f"/Items?ParentId={lib['ItemId']}&Recursive=true&IncludeItemTypes=Movie&Fields=Path")["Items"]
    for native in movies:
        must("POST", f"/UserPlayedItems/{native['Id']}?userId={user}")
    print("acted; movie items", len(movies), "movie entry", movie and movie["id"])


def remember_entries():
    known = json.load(open(ENTRIES)) if os.path.exists(ENTRIES) else []
    for name, tmdb in ((SHOW_LIBRARY, SERIES_TMDB), (MOVIE_LIBRARY, MOVIE_TMDB)):
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
    for name, tmdb in ((SHOW_LIBRARY, SERIES_TMDB), (MOVIE_LIBRARY, MOVIE_TMDB)):
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
        cmd_configure(0, 1)
        cmd_preview()
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
        cmd_restore()
        cmd_cleanup()
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
        print("warnings the ordinary user sees:", [(w["deadline"], w["cause"]) for w in warnings])
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


def cmd_real():
    user = selected_user()
    series, detail = series_detail()
    base = f"/JellyfinMod/Entries/{series['id']}"
    e03 = tracked_episode(detail, 3)
    mark_played("E03", user)
    time.sleep(8)
    _, detail = series_detail()
    e03 = tracked_episode(detail, 3)
    deadline = e03["retention"].get("deadline")
    print("E03 scheduled", e03["retention"]["state"], deadline, "warning", e03.get("retentionWarning"))
    check(e03["retention"]["state"] == "scheduled" and e03.get("retentionWarning"), "E03 is scheduled with a warning")
    # A window started by a sync client (Trakt-style user data) names that cause in the warning and History (Q8).
    sync_watch("E10-B", user)
    time.sleep(8)
    _, detail = series_detail()
    e10 = tracked_episode(detail, 10)
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
    saved = json.load(open(RESTORE))
    retention = must("GET", "/JellyfinMod/Settings/Retention")
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
    import shutil
    for directory in (os.path.join(HOST_MEDIA, ROOTS["A"]), os.path.join(HOST_MEDIA, ROOTS["B"]),
                      os.path.join(HOST_MEDIA, MOVIE_ROOT), os.path.join(HOST_MEDIA, SEED_DIR)):
        if os.path.isdir(directory):
            shutil.rmtree(directory)
    for name in (SHOW_LIBRARY, MOVIE_LIBRARY):
        if library(name) is not None:
            must("DELETE", "/Library/VirtualFolders?" + urllib.parse.urlencode({"name": name, "refreshLibrary": "true"}))
    wait_scan()
    cmd_reconcile()
    known = json.load(open(ENTRIES)) if os.path.exists(ENTRIES) else []
    left = [e["id"] for e in must("GET", "/JellyfinMod/Entries?limit=200&query=JellyfinMod")["items"]]
    for entry_id in dict.fromkeys(known + left):
        status, _ = call("DELETE", f"/JellyfinMod/Entries/{entry_id}")
        print("remove entry", entry_id, status)
    for entry_id in known:
        status, _ = call("GET", f"/JellyfinMod/Entries/{entry_id}")
        check(status == 404, f"fixture entry {entry_id} is gone")
    remaining = must("GET", "/Items?Recursive=true&SearchTerm=JellyfinMod&IncludeItemTypes=Movie,Series,Episode")["TotalRecordCount"]
    entries = must("GET", "/JellyfinMod/Entries?limit=200&query=JellyfinMod")["totalRecordCount"]
    files = [d for d in (ROOTS["A"], ROOTS["B"], MOVIE_ROOT, SEED_DIR) if os.path.exists(os.path.join(HOST_MEDIA, d))]
    check(remaining == 0 and entries == 0 and not files, f"no JellyfinMod fixture left: items {remaining}, entries {entries}, dirs {files}")


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


if __name__ == "__main__":
    os.makedirs(STATE, mode=0o700, exist_ok=True)
    args = sys.argv[1:] or ["help"]
    commands = {
        "login": cmd_login, "logout": cmd_logout, "save": cmd_save, "media": cmd_media, "library": cmd_library,
        "reconcile": cmd_reconcile, "backlog": cmd_backlog, "act": cmd_act, "state": cmd_state, "preview": cmd_preview,
        "run": cmd_run, "ordinary": cmd_ordinary, "refresh": cmd_refresh, "real": cmd_real, "series-keep": cmd_series_keep,
        "restore": cmd_restore, "cleanup": cmd_cleanup, "seed-server": cmd_seed_server,
    }
    if args[0] == "configure":
        cmd_configure(int(args[1]), int(args[2]))
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
