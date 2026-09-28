#!/usr/bin/env python3
"""Live acceptance of V1 rows 14-19 (docs/jellyfinmod/V1.md) on the live instance `jellyfinmod-live`, port 48096 only.

Runs on the test host from the live harness folder (<state root>/standins/bin, next to live-jf.py, live-stage.sh and
live-cleanup.py): it signs in through live-jf.py (token in a 0600 file, never printed), stages legal fixture releases of
the stand-in titles (tmdb 700006 "JellyfinMod Live Long", tmdb 800001 "JellyfinMod Live Series") on the private feed,
and drives grabs, imports, automation and retention through the real HTTP API with the real Transmission. It refuses
any other base URL or container. Settings it changes are saved first to a 0600 file and restored by `restore`.

Subcommands (scenario order):
  save                       saves automation, retention, the indexer seed goal and the feed releases it withdraws
  setup                      profile "JellyfinMod V1 Upgrade", entries A (Movies), B (Movies B), S (Shows), feed withdrawn
  stage NAME RELEASE-TITLE   stages a 20 s fixture release (tmdb from the title) on the private feed
  withdraw NAME              takes a staged release off the feed
  grab KEY TITLE [EPNO] [addVersion]   searches the target and grabs the release with that raw title
  search KEY [EPNO] [addVersion]       prints the candidates (title, quality, eligible, heldQuality, rejections)
  wait [SECONDS]             waits until the queue has no open import (or SECONDS pass)
  show KEY [EPNO]            state, versions, Jellyfin's PlaybackInfo sources, upgrade, history
  auto-on | auto-run | auto-off     automation switch (budget raised) and one manual run with its decisions
  searchnow KEY [EPNO]       makes a title (or one episode) due at the next run
  keep KEY                   Keep on a title
  retention-on MINUTES | retention-off   retention for the row, with a fast test window, and back to the saved values
  play-hold KEY SUB SECONDS  a real playback session of the version whose file name contains SUB, kept alive with
                             progress reports until SECONDS pass or the file <state>.stop-playing appears, then stopped
  play-end KEY SUB [EPNO]    plays the version to its end, as a client does
  seedgoal MINUTES           the private feed's seed goal (restored by restore)
  floor-off                  the import seed floor off for the session (restored by restore)
  episode-meta KEY EPNO      the stand-in episode's metadata on its native versions, so reconciliation can verify them
  library-t                  a disposable TV library and entry T for one fresh episode target (removed by restore)
  profile main|episode CUTOFF MODE  cutoff and upgrade mode of the created profile (episode: created for S on first use)
  retention-run              the native reclamation task, then its summary
  preview                    retention preview rows of this instance's fixtures
  sql QUERY                  read-only query on the plugin database
  restore                    automation off, retention and settings back, profile deleted, feed releases re-published
"""
import importlib.util, json, os, subprocess, sys, time, urllib.parse, urllib.request, uuid

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
spec = importlib.util.spec_from_file_location("jf", os.path.join(HERE, "live-jf.py"))
jf = importlib.util.module_from_spec(spec); spec.loader.exec_module(jf)
PORT, CONTAINER = 48096, "jellyfinmod-live"
if urllib.parse.urlsplit(jf.BASE).port != PORT:
    sys.exit(f"REFUSED: live-jf.py targets {jf.BASE}, not port {PORT}")
ports = subprocess.run(["docker", "port", CONTAINER], capture_output=True, text=True).stdout
if f":{PORT}" not in ports:
    sys.exit(f"REFUSED: {CONTAINER} does not publish {PORT}")

STATE = os.path.join(ROOT, "standins", "state", "v1-live48.json")
DB = os.path.join(ROOT, "config", "data", "jellyfinmod", "jellyfinmod.db")
CONTROL = "http://127.0.0.1:48119"
PLUGIN = "6f1a2b3c4d5e4f609a718b2c3d4e5f60"
FEED = "d7aba75b6dab44e38dcdbff88292a794"
PROFILE = "JellyfinMod V1 Upgrade"
EPISODE_PROFILE = "JellyfinMod V1 Episode Upgrade"
QUALITIES = ["bluray-2160p", "webdl-2160p", "bluray-1080p", "webdl-1080p", "bluray-720p", "webdl-720p"]
LIBS = {"A": "Movies", "B": "Movies B", "S": "Shows"}
TMDB = {"A": 700006, "B": 700006, "S": 800001, "T": 800001}
# A second, disposable TV library for one fresh episode target (T): created by `library-t`, removed by `restore`.
T_LIBRARY, T_FOLDER = "JellyfinMod V1 Shows B", "/accept/live48096/media/tv-b"


def call(method, path, body=None, user="oleksii"):
    status, text = jf.call(method, path, body, user=user)
    try:
        return status, (json.loads(text) if text else None)
    except ValueError:
        return status, text


def must(method, path, body=None):
    status, result = call(method, path, body)
    if status >= 300:
        sys.exit(f"FAIL {method} {path} -> {status} {str(result)[:300]}")
    return result


def state():
    return json.load(open(STATE)) if os.path.exists(STATE) else {}


def put_state(data):
    fd = os.open(STATE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    os.write(fd, json.dumps(data, indent=1).encode())
    os.close(fd)


def control(path, body=None):
    request = urllib.request.Request(CONTROL + path, data=None if body is None else json.dumps(body).encode(),
                                     method="GET" if body is None else "POST")
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def entry_id(key):
    return state()["entries"][key]


def detail(key):
    return must("GET", f"/JellyfinMod/Entries/{entry_id(key)}")


def episode(key, number):
    return next(e for e in detail(key)["episodes"] if e["seasonNumber"] == 1 and e["episodeNumber"] == int(number))


def uid():
    return next(u for u in must("GET", "/Users") if u["Name"] == "oleksii")["Id"]


def name(path):
    return (path or "").rsplit("/", 1)[-1]


# --- setup and restore ---

def cmd_save():
    if os.path.exists(STATE):
        sys.exit("state file exists; not overwriting")
    feed = [r for r in control("/state")["releases"] if r.get("tmdbid") in (700006, 800001)]
    indexer = next(i for i in must("GET", "/JellyfinMod/Settings/Indexers") if i["id"] == FEED)
    put_state({"automation": must("GET", "/JellyfinMod/Settings/Automation"),
               "retention": must("GET", "/JellyfinMod/Settings/Retention"),
               "testWindow": must("GET", f"/Plugins/{PLUGIN}/Configuration").get("RetentionTestWindowMinutes", 0),
               "seedMinutes": indexer.get("minimumSeedMinutes"), "withdrawn": feed, "staged": [], "entries": {}})
    print("saved; feed releases to withdraw:", [r["id"] for r in feed])


def cmd_setup():
    data = state()
    for release in data["withdrawn"]:
        control(f"/withdraw?id={urllib.parse.quote(release['id'])}", {})
    profiles = must("GET", "/JellyfinMod/Settings/QualityProfiles")
    profile = next((p for p in profiles if p["name"] == PROFILE), None)
    if profile is None:
        profile = must("POST", "/JellyfinMod/Settings/QualityProfiles", {
            "name": PROFILE, "qualities": QUALITIES,
            "minimumBytesPerHour": None, "maximumBytesPerHour": None, "cutoff": "bluray-1080p", "upgradeAllowed": True,
            "upgradeMode": "replace", "minimumAutoScore": None, "minimumSeeders": 1})
    data["profile"] = profile["id"]
    folders = {f["Name"]: f["ItemId"] for f in must("GET", "/Library/VirtualFolders")}
    for key, library in LIBS.items():
        media = "series" if key == "S" else "movie"
        created = must("POST", "/JellyfinMod/Entries", {"mediaType": media, "tmdbId": TMDB[key], "targetLibraryId": folders[library]})
        data["entries"][key] = created["entry"]["id"]
        must("PATCH", f"/JellyfinMod/Entries/{created['entry']['id']}", {"qualityProfileId": profile["id"]})
    put_state(data)
    print("profile", profile["id"][:8], "entries", {k: v[:8] for k, v in data["entries"].items()},
          "withdrawn", len(data["withdrawn"]))


def cmd_profile(which, cutoff, mode):
    """Sets a created profile's cutoff and mode; `episode` creates the episode profile and gives it to S on first use."""
    data = state()
    if which == "episode" and not data.get("episodeProfile"):
        created = must("POST", "/JellyfinMod/Settings/QualityProfiles", {
            "name": EPISODE_PROFILE, "qualities": QUALITIES, "minimumBytesPerHour": None, "maximumBytesPerHour": None,
            "cutoff": cutoff, "upgradeAllowed": True, "upgradeMode": mode, "minimumAutoScore": None, "minimumSeeders": 1})
        data["episodeProfile"] = created["id"]
        put_state(data)
        must("PATCH", f"/JellyfinMod/Entries/{entry_id('S')}", {"qualityProfileId": created["id"]})
    ident = data["episodeProfile"] if which == "episode" else data["profile"]
    subprocess.run([sys.executable, os.path.join(HERE, "live-jf.py"), "merge", "QualityProfiles", ident,
                    json.dumps({"cutoff": cutoff, "upgradeMode": mode})], capture_output=True, text=True)
    profile = next(p for p in must("GET", "/JellyfinMod/Settings/QualityProfiles") if p["id"] == ident)
    print("profile", profile["name"], "cutoff", profile["cutoff"], "mode", profile["upgradeMode"], "upgrades", profile["upgradeAllowed"])


def cmd_library_t():
    """A disposable TV library on the instance's own writable mount, and entry T for the stand-in series in it."""
    data = state()
    host = host_path(T_FOLDER)
    if not host:
        sys.exit(f"REFUSED: {T_FOLDER} is not on a mount of {CONTAINER}")
    os.makedirs(host, exist_ok=True)
    if not any(f["Name"] == T_LIBRARY for f in must("GET", "/Library/VirtualFolders")):
        must("POST", f"/Library/VirtualFolders?name={urllib.parse.quote(T_LIBRARY)}&collectionType=tvshows&refreshLibrary=false",
             {"LibraryOptions": {"PathInfos": [{"Path": T_FOLDER}], "EnableRealtimeMonitor": False}})
    data["tLibrary"] = host
    folder = None
    for _ in range(20):
        folder = next((f for f in must("GET", "/Library/VirtualFolders") if f["Name"] == T_LIBRARY), None)
        if folder and folder.get("ItemId"):
            break
        time.sleep(3)
    created = must("POST", "/JellyfinMod/Entries", {"mediaType": "series", "tmdbId": 800001, "targetLibraryId": folder["ItemId"]})
    data["entries"]["T"] = created["entry"]["id"]
    put_state(data)
    must("PATCH", f"/JellyfinMod/Entries/{created['entry']['id']}", {"qualityProfileId": data["episodeProfile"]})
    print("library", T_LIBRARY, folder["ItemId"][:8], "entry T", created["entry"]["id"][:8])


def cmd_floor_off():
    """Turns the import seed floor off for the session (the instance's 1.0 / 168 h floor keeps every plugin-seeded file
    `seed_goal_unmet` for a week, so no replacement or reclaim could run); `restore` puts it back."""
    data = state()
    current = must("GET", "/JellyfinMod/Settings/Import")
    data.setdefault("import", {"seedFloorRatio": current["seedFloorRatio"], "seedFloorHours": current["seedFloorHours"]})
    put_state(data)
    after = must("PATCH", "/JellyfinMod/Settings/Import", current | {"seedFloorRatio": None, "seedFloorHours": None})
    print("import seed floor", after["seedFloorRatio"], after["seedFloorHours"], "revision", after["revision"])


def cmd_episode_meta(key, number):
    """Gives an episode's native versions the catalog episode's title, air date and TMDB id through the stock item update.
    The stand-in files carry no metadata, so reconciliation could not verify which episode they are (RET2-R3) and an
    upgrade would wait with `identity_unverified`; real libraries get this from the metadata provider."""
    target = episode(key, number)
    info = must("POST", f"/Items/{target['jellyfinItemId']}/PlaybackInfo?userId={uid()}", {})
    for source in info["MediaSources"]:
        item = must("GET", f"/Items/{source['Id']}?userId={uid()}")
        item.update({"Name": target["title"], "PremiereDate": target["airDate"],
                     "ProviderIds": dict(item.get("ProviderIds") or {}, **({"Tmdb": str(target["tmdbId"])} if target.get("tmdbId") else {}))})
        must("POST", f"/Items/{source['Id']}", item)
        print("metadata", name(source.get("Path")), target["title"], (target["airDate"] or "")[:10])
    must("POST", "/Library/Refresh")


def cmd_restore():
    data = state()
    auto = must("GET", "/JellyfinMod/Settings/Automation")
    saved = data["automation"]
    must("PATCH", "/JellyfinMod/Settings/Automation", {k: saved[k] for k in saved if k != "revision"} |
         {"automationEnabled": False, "episodeUpgradesEnabled": False, "revision": auto["revision"]})
    cmd_retention_off()
    cmd_seedgoal(data["seedMinutes"])
    if "import" in data:
        current = must("GET", "/JellyfinMod/Settings/Import")
        after = must("PATCH", "/JellyfinMod/Settings/Import", current | data["import"])
        print("import seed floor", after["seedFloorRatio"], after["seedFloorHours"], "revision", after["revision"])
    if data.get("tLibrary"):
        status, _ = call("DELETE", f"/Library/VirtualFolders?name={urllib.parse.quote(T_LIBRARY)}&refreshLibrary=false")
        print("library", T_LIBRARY, "removed", status)
    for key in ("episodeProfile", "profile"):
        if data.get(key):
            status, _ = call("DELETE", f"/JellyfinMod/Settings/QualityProfiles/{data[key]}")
            print("profile deleted", key, status)
    for release in data["withdrawn"]:
        control("/release", {"id": release["id"], "indexerId": release["indexerId"], "title": release["title"],
                             "torrentName": release["torrentName"], "tmdbid": release["tmdbid"], "seeders": release["seeders"],
                             "category": release["category"], "webseed": True,
                             **({"files": [{"path": p["path"], "file": p["file"]} for p in release["parts"]]}
                                if release["parts"][0]["path"] else {"file": release["file"]})})
    for staged in data["staged"]:
        control(f"/withdraw?id={urllib.parse.quote(staged)}", {})
    now = [r["id"] for r in control("/state")["releases"] if r.get("tmdbid") in (700006, 800001)]
    print("feed releases of the stand-in titles now", now)
    print("automation", {k: v for k, v in must("GET", "/JellyfinMod/Settings/Automation").items()
                         if k in ("automationEnabled", "episodeUpgradesEnabled", "dailyAutoGrabBudget", "revision")})


# --- fixtures, search and grab ---

def cmd_stage(key, title):
    tmdb, category = (800001, 5040) if ".Series." in title else (700006, 2040)
    out = subprocess.run([os.path.join(HERE, "live-stage.sh"), key, title + ".mkv", title, str(tmdb), str(category)],
                         capture_output=True, text=True, env=dict(os.environ, FIXTURE_SECONDS="20"))
    print(out.stdout.strip()[-200:], out.stderr.strip()[-200:])
    data = state()
    data["staged"] = sorted(set(data["staged"]) | {key})
    put_state(data)


def cmd_withdraw(key):
    print(control(f"/withdraw?id={urllib.parse.quote(key)}", {}))


def search(key, number=None, intent=None):
    path = f"/JellyfinMod/Releases?entryId={entry_id(key)}"
    if number:
        path += f"&episodeId={episode(key, number)['id']}"
    if intent:
        path += f"&intent={intent}"
    return call("GET", path)


def cmd_search(key, number=None, intent=None):
    status, found = search(key, None if number in (None, "-") else number, intent)
    if status != 200:
        print("search", status, str(found)[:300]); return
    print("search", status, "intent", intent or "acquire", "grab", found.get("grab"))
    for c in found["candidates"]:
        if c["indexerName"] != "Private fixture feed":
            continue
        print(" ", c["rawTitle"], c["parsed"]["quality"], "proper" if c.get("proper") else "", "repack" if c.get("repack") else "",
              "eligible" if c["eligible"] else "rejected", "heldQuality" if c.get("heldQuality") else "",
              [r["code"] for r in c["rejections"]], c["score"])


def cmd_grab(key, title, number=None, intent=None):
    status, found = search(key, None if number in (None, "-") else number, intent)
    if status != 200:
        print("search", status, str(found)[:300]); return
    row = next((c for c in found["candidates"] if c["rawTitle"] == title), None)
    if row is None:
        print("not found; candidates", [c["rawTitle"] for c in found["candidates"]]); return
    status, body = call("POST", "/JellyfinMod/Releases/Grab", {"searchId": found["searchId"], "releaseId": row["releaseId"],
                                                               "idempotencyKey": "v1-" + uuid.uuid4().hex})
    if status != 202:
        print("grab", status, str(body)[:300]); return
    deadline = time.time() + 60
    while time.time() < deadline:
        time.sleep(2)
        body = must("GET", f"/JellyfinMod/Grabs/{body['id']}")
        if body["state"] not in ("pending", "submitting"):
            break
    print("grab", status, title, body["state"], body.get("failureCode"), (body.get("infoHash") or "")[:8])


def cmd_wait(seconds="600"):
    deadline = time.time() + int(seconds)
    while time.time() < deadline:
        rows = must("GET", "/JellyfinMod/Queue")["items"]
        open_rows = [r for r in rows if r["importState"] not in ("completed", "failed", "cancelled")]
        if not open_rows:
            break
        time.sleep(15)
    for r in must("GET", "/JellyfinMod/Queue")["items"]:
        print(" ", (r.get("entry") or {}).get("title"), (r.get("episode") or {}).get("label") or "", r["importState"], r.get("reason"),
              (r.get("releaseTitle") or "")[:60])


# --- reading ---

def sources(item_id):
    info = must("POST", f"/Items/{item_id}/PlaybackInfo?userId={uid()}", {})
    return [(name(s.get("Path")), s["Id"][:8]) for s in info["MediaSources"]]


def cmd_show(key, number=None):
    d = detail(key)
    target = episode(key, number) if number else d["entry"]
    versions = (target.get("versions") if number else d.get("versions")) or []
    print(key, d["entry"]["title"], "state", target.get("state"), "monitored", target.get("monitored"), "item",
          (target.get("jellyfinItemId") or "")[:8])
    for v in versions:
        print("  version", v.get("label"), v.get("quality"), "default" if v["isDefault"] else "", "tracked" if v.get("tracked") else "UNTRACKED",
              "binding", (v.get("bindingId") or "")[:8], "range", v.get("episodeRange"), "removable", v.get("removable"),
              "retention", v.get("retention"))
    item = target.get("jellyfinItemId")
    if item:
        print("  PlaybackInfo", sources(item))
    if not number and d.get("upgrade"):
        print("  upgrade", d["upgrade"])
    for h in d["history"][-12:]:
        print("  history", h["createdAt"][11:19], h["eventType"], h["summary"][:120])


def cmd_decisions(key, since=None):
    rows = must("GET", f"/JellyfinMod/Automation/Decisions?entryId={entry_id(key)}&limit=30")
    items = rows["items"] if isinstance(rows, dict) else rows
    for r in items:
        if since and r["createdAt"] < since:
            continue
        print(" ", r["createdAt"][11:19], r.get("episodeLabel") or (r.get("episodeId") or "")[:8], r["kind"], r.get("reason"),
              (r.get("detail") or "")[:110])


# --- automation ---

def cmd_auto_on():
    auto = must("GET", "/JellyfinMod/Settings/Automation")
    auto.update({"automationEnabled": True, "dailyAutoGrabBudget": 12, "episodeUpgradesEnabled": True})
    after = must("PATCH", "/JellyfinMod/Settings/Automation", auto)
    print("automation on", after["automationEnabled"], "budget", after["dailyAutoGrabBudget"], "episodes", after["episodeUpgradesEnabled"])


def cmd_auto_off():
    auto = must("GET", "/JellyfinMod/Settings/Automation")
    auto["automationEnabled"] = False
    print("automation on", must("PATCH", "/JellyfinMod/Settings/Automation", auto)["automationEnabled"])


def cmd_searchnow(key, number=None):
    path = f"/JellyfinMod/Entries/{entry_id(key)}" + (f"/Episodes/{episode(key, number)['id']}" if number else "")
    must("PATCH", path, {"searchNow": True})
    print("due next run:", key, number or "")


def cmd_auto_run():
    before = (must("GET", "/JellyfinMod/Automation/Status").get("lastRun") or {}).get("startedAt") or ""
    started = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime())
    must("POST", "/JellyfinMod/Automation/Run", {})
    deadline = time.time() + 600
    while time.time() < deadline:
        time.sleep(10)
        status = must("GET", "/JellyfinMod/Automation/Status")
        last = status.get("lastRun") or {}
        if not status["running"] and (last.get("startedAt") or "") > before:
            break
    print("run", {k: last.get(k) for k in ("trigger", "status", "targetsConsidered", "searched", "skipped", "grabbed", "upgradesPlanned", "detail")})
    for key in state()["entries"]:
        cmd_decisions(key, started)


# --- retention ---

def container_mounts():
    """The container's mounts, longest destination first, to find a container path's file on this host."""
    inspected = json.loads(subprocess.run(["docker", "inspect", CONTAINER], capture_output=True, text=True, timeout=60,
                                          check=True).stdout)[0]
    return sorted(((m["Destination"], m["Source"]) for m in inspected.get("Mounts") or []), key=lambda m: -len(m[0]))


def host_path(path, mounts=None):
    for destination, source in mounts or container_mounts():
        if path == destination or path.startswith(destination + "/"):
            return source + path[len(destination):]
    return None


def host_identity(path, mounts):
    host = host_path(path, mounts) if path else None
    try:
        st = os.stat(host) if host else None
    except OSError:
        return None
    return (st.st_dev, st.st_ino) if st else None


def harness_entries():
    """The session's own stand-in entries (A, B, S, T); everything else on the instance is protected."""
    return {value.replace("-", "").lower() for value in (state().get("entries") or {}).values()}


def all_entries():
    found, start = [], 0
    while True:
        page = must("GET", f"/JellyfinMod/Entries?startIndex={start}&limit=200")
        found += page["items"]
        start += len(page["items"])
        if not page["items"] or start >= page["totalRecordCount"]:
            return found


def unprotected():
    """Bindings outside the session's stand-in entries that nothing keeps per file: every retention preview target (what
    the executor acts on, movies and episode versions) and every tracked version on every catalog page. A binding counts
    as kept by identity only when this host proves it is the same inode as a file its entry keeps."""
    own, mounts, missing, kept = harness_entries(), container_mounts(), {}, {}
    targets = must("GET", "/JellyfinMod/Retention/Preview")["items"]
    for item in targets:
        if item.get("reason") == "version_kept" and item.get("path"):
            identity = host_identity(item["path"], mounts)
            if identity:
                kept.setdefault(item["entryId"], set()).add(identity)
    for item in targets:
        if item["entryId"].replace("-", "").lower() in own or item.get("reason") == "version_kept":
            continue
        if host_identity(item.get("path"), mounts) in kept.get(item["entryId"], set()):
            continue
        missing[item["bindingId"]] = (item["entryId"], name(item.get("path")))
    for entry_row in all_entries():
        if entry_row["id"].replace("-", "").lower() in own:
            continue
        found = must("GET", f"/JellyfinMod/Entries/{entry_row['id']}")
        rows = list(found.get("versions") or []) + [v for e in found.get("episodes") or [] for v in e.get("versions") or []]
        for version in rows:
            if version.get("tracked") is not False and not version.get("kept"):
                missing.setdefault(version["bindingId"], (entry_row["id"], entry_row["title"]))
    return missing


def protect():
    """Keeps, per file, every binding outside the stand-in entries (each Keep saved as it is made, so `retention-off`
    removes them even after a failure), then refuses unless nothing outside the stand-ins is left unkept."""
    data = state()
    data.setdefault("keeps", [])
    recorded = {binding for _, binding in data["keeps"]}
    for binding_id, (entry, _) in unprotected().items():
        if binding_id in recorded:
            continue
        must("POST", f"/JellyfinMod/Entries/{entry}/Versions/{binding_id}/Keep")
        data["keeps"].append([entry, binding_id])
        put_state(data)
    verify_protection()


def verify_protection():
    missing = unprotected()
    for binding_id, (_, label) in list(missing.items())[:10]:
        print("  not kept:", binding_id, label)
    if missing:
        sys.exit(f"REFUSED: {len(missing)} bindings outside the stand-in entries are not kept; retention stays as it is")
    print("protection verified: every binding outside the stand-in entries is kept per file,",
          len(state().get("keeps") or []), "session Keeps")


def set_window(minutes):
    config = must("GET", f"/Plugins/{PLUGIN}/Configuration")
    config["RetentionTestWindowMinutes"] = int(minutes)
    must("POST", f"/Plugins/{PLUGIN}/Configuration", config)


def cmd_retention_on(minutes):
    # Global retention with a minute-scale window may reclaim any due binding: never switch it on unprotected (W-2).
    protect()
    set_window(minutes)
    retention = must("GET", "/JellyfinMod/Settings/Retention")
    after = must("PATCH", "/JellyfinMod/Settings/Retention", {"enabled": True, "reclaimAfterDays": 1, "watchedUserMode": "selectedUser",
                 "selectedUserId": uid(), "exemptFavourites": True, "revision": retention["revision"]})
    print("retention on", after["enabled"], "window", after.get("testWindowMinutes"), "revision", after["revision"])


def cmd_retention_off():
    saved = state()["retention"]
    retention = must("GET", "/JellyfinMod/Settings/Retention")
    set_window(state()["testWindow"])
    body = {k: saved.get(k) for k in ("enabled", "reclaimAfterDays", "watchedUserMode", "exemptFavourites")}
    if saved.get("selectedUserId"):
        body["selectedUserId"] = saved["selectedUserId"]
    after = must("PATCH", "/JellyfinMod/Settings/Retention", body | {"revision": retention["revision"]})
    print("retention", after["enabled"], "window", after.get("testWindowMinutes"), "mode", after["watchedUserMode"],
          "days", after["reclaimAfterDays"], "revision", after["revision"])
    data = state()
    for entry, binding_id in data.get("keeps") or []:
        call("DELETE", f"/JellyfinMod/Entries/{entry}/Versions/{binding_id}/Keep")
    print("session Keeps removed:", len(data.get("keeps") or []))
    data["keeps"] = []
    put_state(data)


def cmd_seedgoal(minutes):
    subprocess.run([sys.executable, os.path.join(HERE, "live-jf.py"), "merge", "Indexers", FEED,
                    json.dumps({"minimumSeedMinutes": None if minutes in (None, "None") else int(minutes)})],
                   capture_output=True, text=True)
    indexer = next(i for i in must("GET", "/JellyfinMod/Settings/Indexers") if i["id"] == FEED)
    print("private feed seed goal", indexer.get("minimumSeedMinutes"))


def cmd_retention_run():
    verify_protection()
    task = next(t for t in must("GET", "/ScheduledTasks") if t["Key"] == "JellyfinModRetentionReclamation")
    started = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime())
    must("POST", f"/ScheduledTasks/Running/{task['Id']}")
    deadline = time.time() + 600
    while time.time() < deadline:
        time.sleep(5)
        current = must("GET", f"/ScheduledTasks/{task['Id']}")
        if current["State"] == "Idle" and (current.get("LastExecutionResult") or {}).get("StartTimeUtc", "") >= started:
            break
    latest = must("GET", "/JellyfinMod/Retention/Runs/Latest")
    print("retention run", {k: latest.get(k) for k in ("status", "inspected", "eligible", "blocked", "reclaimed", "failed",
                                                          "logicalBytesUnlinked", "physicalBytesReleased")})


def cmd_preview():
    for item in must("GET", "/JellyfinMod/Retention/Preview")["items"]:
        print(" ", name(item.get("path")), item["state"], item["reason"], (item.get("deadline") or "")[:19])


# --- playback ---

def version_source(key, sub, number=None):
    target = episode(key, number) if number else detail(key)["entry"]
    item = target["jellyfinItemId"]
    info = must("POST", f"/Items/{item}/PlaybackInfo?userId={uid()}", {})
    source = next(s for s in info["MediaSources"] if sub in name(s.get("Path")))
    return item, source["Id"], name(source.get("Path"))


def cmd_play_hold(key, sub, seconds, number=None):
    item, source, file = version_source(key, sub, number)
    body = {"ItemId": item, "MediaSourceId": source, "PositionTicks": 10_000_000, "PlayMethod": "DirectPlay",
            "PlaySessionId": "jfmod-v1-hold-" + source[:8], "CanSeek": True, "IsPaused": False}
    must("POST", "/Sessions/Playing", body)
    print("playing", file, flush=True)
    deadline = time.time() + int(seconds)
    position = 10_000_000
    try:
        stop = STATE + ".stop-playing"
        while time.time() < deadline and not os.path.exists(stop):
            time.sleep(15)
            position += 150_000_000
            must("POST", "/Sessions/Playing/Progress", dict(body, PositionTicks=position))
    finally:
        must("POST", "/Sessions/Playing/Stopped", dict(body, PositionTicks=position))
        print("stopped", file, time.strftime("%H:%M:%S", time.gmtime()), flush=True)


def cmd_play_end(key, sub, number=None):
    item, source, file = version_source(key, sub, number)
    ticks = must("GET", f"/Items/{item}?userId={uid()}").get("RunTimeTicks") or 200_000_000
    body = {"ItemId": item, "MediaSourceId": source, "PositionTicks": 0, "PlayMethod": "DirectPlay", "PlaySessionId": "jfmod-v1-end-" + source[:8]}
    must("POST", "/Sessions/Playing", body)
    time.sleep(2)
    must("POST", "/Sessions/Playing/Stopped", dict(body, PositionTicks=ticks))
    data = must("GET", f"/Items/{item}?userId={uid()}")["UserData"]
    print("played to the end", file, "played", data.get("Played"), "last", (data.get("LastPlayedDate") or "")[:19])


def cmd_keep(key):
    print("keep", call("POST", f"/JellyfinMod/Entries/{entry_id(key)}/Keep")[0])


def cmd_sql(query):
    import sqlite3
    db = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    for row in db.execute(query):
        print(" ", row)


COMMANDS = {"save": cmd_save, "setup": cmd_setup, "restore": cmd_restore, "stage": cmd_stage, "withdraw": cmd_withdraw,
            "search": cmd_search, "grab": cmd_grab, "wait": cmd_wait, "show": cmd_show, "decisions": cmd_decisions,
            "auto-on": cmd_auto_on, "auto-off": cmd_auto_off, "auto-run": cmd_auto_run, "searchnow": cmd_searchnow,
            "retention-on": cmd_retention_on, "retention-off": cmd_retention_off, "seedgoal": cmd_seedgoal,
            "retention-run": cmd_retention_run, "preview": cmd_preview, "play-hold": cmd_play_hold, "play-end": cmd_play_end,
            "keep": cmd_keep, "sql": cmd_sql, "profile": cmd_profile, "library-t": cmd_library_t,
            "floor-off": cmd_floor_off, "episode-meta": cmd_episode_meta}

if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        sys.exit(__doc__)
    COMMANDS[sys.argv[1]](*sys.argv[2:])
